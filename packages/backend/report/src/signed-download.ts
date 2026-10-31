/**
 * HMAC-signed download tokens for report artifacts (same shape as gradebook
 * board-export tokens in packages/backend/gradebook/src/signed-download.ts).
 *
 * PRC-L337 (topic 2): one secret per purpose. The report download token is
 * signed with a dedicated REPORT_DOWNLOAD_SIGNING_SECRET. It never falls back
 * to SIS_BOARD_EXPORT_SIGNING_SECRET, JWT_SECRET, or a committed literal. A
 * deployed (production-like) environment fail-closes with
 * ReportDownloadSigningKeyMissingError when the dedicated secret is missing,
 * equals JWT_SECRET, or is the retired placeholder. Outside production a
 * process-local ephemeral HMAC key is generated at startup so local dev keeps
 * working without a committed literal (see prepareReportDownloadSigningAtStartup).
 *
 * The token binds tenantId + artifactId + actorId + exp, so a link minted for
 * one user cannot be replayed by another even within the same tenant.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { isProductionLike } from '@proctira/common/node-env';

export type ReportSignedDownload = {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
};

export type ReportDownloadSigningLog = {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

/**
 * Dependency-free fallback logger. The plugin injects a real (pino) logger via
 * prepareReportDownloadSigningAtStartup; this keeps the module from adding a
 * logging dependency (PRC batch rule: B05 adds no dependency).
 */
const noopLog: ReportDownloadSigningLog = {
  warn: () => {},
  error: () => {},
};

export const REPORT_DOWNLOAD_SIGNING_KEY_MISSING_MESSAGE =
  'Report download signing key is not configured. Set a dedicated ' +
  'REPORT_DOWNLOAD_SIGNING_SECRET (never reuse JWT_SECRET or ' +
  'SIS_BOARD_EXPORT_SIGNING_SECRET, and never the retired dev placeholder). ' +
  'Report download links stay blocked until it is set. See .env.example.';

/** Retired dev-only placeholder that must never sign in a deployed environment. */
const REPORT_DOWNLOAD_DEV_PLACEHOLDER = 'sis-board-export-dev-secret-change-me';

export class ReportDownloadSigningKeyMissingError extends Error {
  readonly code = 'REPORT_DOWNLOAD_SIGNING_KEY_MISSING' as const;
  readonly statusCode = 503;

  constructor(detail?: string) {
    super(detail ?? REPORT_DOWNLOAD_SIGNING_KEY_MISSING_MESSAGE);
    this.name = 'ReportDownloadSigningKeyMissingError';
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

export function isReportDownloadSigningKeyMissingError(
  error: unknown,
): error is ReportDownloadSigningKeyMissingError {
  return (
    error instanceof ReportDownloadSigningKeyMissingError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'REPORT_DOWNLOAD_SIGNING_KEY_MISSING' &&
      typeof (error as { toJSON?: unknown }).toJSON === 'function')
  );
}

type EphemeralDevKey = { secret: string; logged: boolean };

/** Process-local only. Never written to disk and never used in a deployed env. */
let ephemeralDevKey: EphemeralDevKey | null = null;

/** Test hook. Production code must not call this. */
export function resetDevReportDownloadSigningForTests(): void {
  ephemeralDevKey = null;
}

function ensureEphemeralDevKey(env: NodeJS.ProcessEnv, log: ReportDownloadSigningLog): string {
  if (!ephemeralDevKey) {
    ephemeralDevKey = { secret: randomBytes(32).toString('base64url'), logged: false };
  }
  if (!ephemeralDevKey.logged) {
    ephemeralDevKey.logged = true;
    log.warn(
      {
        event: 'report_download_signing_dev_ephemeral_key',
        nodeEnv: env.NODE_ENV ?? 'undefined',
      },
      'REPORT_DOWNLOAD_SIGNING_SECRET is unset outside production. Using an ephemeral in-memory HMAC key for this process only. It is not persisted, is not valid across restarts, and must not sign real report downloads. Set REPORT_DOWNLOAD_SIGNING_SECRET before production.',
    );
  }
  return ephemeralDevKey.secret;
}

/**
 * Startup hook for the report catalogue plugin. Outside production, generates
 * the ephemeral report-download key once when the secret is unset and logs it.
 * In a production-like env, logs an actionable error and leaves signing
 * fail-closed (no key is invented, JWT_SECRET is never adopted).
 */
export function prepareReportDownloadSigningAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  log: ReportDownloadSigningLog = noopLog,
): void {
  const secret = env.REPORT_DOWNLOAD_SIGNING_SECRET?.trim();
  if (isProductionLike(env.NODE_ENV)) {
    if (!secret || secret === REPORT_DOWNLOAD_DEV_PLACEHOLDER) {
      log.error(
        {
          event: 'report_download_signing_key_missing',
          missing: ['REPORT_DOWNLOAD_SIGNING_SECRET'],
        },
        REPORT_DOWNLOAD_SIGNING_KEY_MISSING_MESSAGE,
      );
    }
    return;
  }
  if (!secret) {
    ensureEphemeralDevKey(env, noopLog);
  }
}

/**
 * Resolve the dedicated report download signing secret.
 *
 * A production-like environment (anything other than `development` / `test`,
 * so unset / `staging` fail closed) fail-closes when
 * REPORT_DOWNLOAD_SIGNING_SECRET is missing, equals JWT_SECRET, or is the
 * retired dev placeholder. JWT_SECRET and SIS_BOARD_EXPORT_SIGNING_SECRET are
 * never a fallback. Outside production, a process-local ephemeral key is used
 * so local dev keeps working without a committed literal.
 */
function signingSecret(
  env: NodeJS.ProcessEnv = process.env,
  log: ReportDownloadSigningLog = noopLog,
): string {
  const configured = env.REPORT_DOWNLOAD_SIGNING_SECRET?.trim();
  const jwt = env.JWT_SECRET?.trim();

  if (isProductionLike(env.NODE_ENV)) {
    if (!configured) {
      throw new ReportDownloadSigningKeyMissingError();
    }
    if (configured === REPORT_DOWNLOAD_DEV_PLACEHOLDER) {
      throw new ReportDownloadSigningKeyMissingError(
        'REPORT_DOWNLOAD_SIGNING_SECRET is still the retired dev placeholder. ' +
          REPORT_DOWNLOAD_SIGNING_KEY_MISSING_MESSAGE,
      );
    }
    if (jwt && configured === jwt) {
      throw new ReportDownloadSigningKeyMissingError(
        'REPORT_DOWNLOAD_SIGNING_SECRET must not equal JWT_SECRET (one secret per purpose).',
      );
    }
    return configured;
  }

  // Development / test: prefer a configured dedicated secret, otherwise an
  // ephemeral in-memory key. Never fall back to JWT_SECRET or a committed
  // literal.
  if (configured && configured !== REPORT_DOWNLOAD_DEV_PLACEHOLDER) {
    return configured;
  }
  return ensureEphemeralDevKey(env, log);
}

function payload(tenantId: string, artifactId: string, actorId: string, expUnix: number): string {
  return `${tenantId}:${artifactId}:${actorId}:${expUnix}`;
}

/**
 * Mint a short-lived report download token bound to tenant + artifact + actor.
 * @throws ReportDownloadSigningKeyMissingError in a deployed env with no dedicated secret
 */
export function createReportDownloadToken(
  tenantId: string,
  artifactId: string,
  actorId: string,
  expiresInSeconds = 300,
): ReportSignedDownload {
  const expUnix = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = payload(tenantId, artifactId, actorId, expUnix);
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
  actorId: string,
  token: string,
): { ok: true } | { ok: false; reason: string } {
  const [expRaw, sig] = token.split('.');
  if (!expRaw || !sig) return { ok: false, reason: 'Malformed token' };
  const expUnix = Number(expRaw);
  if (!Number.isFinite(expUnix)) return { ok: false, reason: 'Invalid expiry' };
  if (expUnix < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'Token expired' };
  }
  let expected: string;
  try {
    expected = createHmac('sha256', signingSecret())
      .update(payload(tenantId, artifactId, actorId, expUnix))
      .digest('hex');
  } catch (error: unknown) {
    // Fail closed: a missing dedicated secret must reject, not accept.
    if (isReportDownloadSigningKeyMissingError(error)) {
      return { ok: false, reason: 'Report download signing key is not configured' };
    }
    throw error;
  }
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
