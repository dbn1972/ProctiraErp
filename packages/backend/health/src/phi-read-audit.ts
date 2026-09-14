/**
 * W1-SEC-10 — PHI read audit must not silently no-op in production.
 *
 * When the repository auditor (`logPhiAccess`) is missing or throws:
 * - production → fail closed (503) unless `ALLOW_PHI_AUDIT_DEGRADE=1`
 * - non-production → allow degrade (no-op / swallow) for local/test repos
 */

import { AppError, ErrorCode } from '@proctira/common';

import type { PhiAccessLogInput } from './pg-special-needs-store.js';

export class PhiAuditUnavailableError extends AppError {
  constructor(
    message = 'PHI read auditor unavailable; refusing to return PHI without an audit trail',
  ) {
    super(message, ErrorCode.SERVICE_UNAVAILABLE, 503);
    this.name = 'PhiAuditUnavailableError';
  }
}

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function isProductionEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return (nodeEnv ?? '').toLowerCase() === 'production';
}

/** Explicit operator escape hatch — must never be set in normal production. */
export function isPhiAuditDegradeAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthy(env.ALLOW_PHI_AUDIT_DEGRADE);
}

/**
 * Whether missing/throwing PHI auditor must fail the read (fail closed).
 */
export function shouldFailClosedOnPhiAudit(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isProductionEnv(env.NODE_ENV) && !isPhiAuditDegradeAllowed(env);
}

export type PhiReadAuditor = (input: PhiAccessLogInput) => Promise<void>;

export interface RecordPhiReadAuditOptions {
  logPhiAccess: PhiReadAuditor | null | undefined;
  entry: PhiAccessLogInput;
  env?: NodeJS.ProcessEnv;
  /** Optional hook for degrade-path diagnostics (tests / ops). */
  onDegrade?: (reason: 'missing_auditor' | 'auditor_threw', error?: unknown) => void;
}

/**
 * Persist a PHI read audit entry. Fail closed in production when the auditor
 * is missing or throws, unless {@link isPhiAuditDegradeAllowed}.
 */
export async function recordPhiReadAudit(options: RecordPhiReadAuditOptions): Promise<void> {
  const env = options.env ?? process.env;
  const failClosed = shouldFailClosedOnPhiAudit(env);
  const auditor = options.logPhiAccess;

  if (typeof auditor !== 'function') {
    if (failClosed) {
      throw new PhiAuditUnavailableError(
        'PHI read auditor missing/misconfigured; set a repository that implements logPhiAccess ' +
          'or ALLOW_PHI_AUDIT_DEGRADE=1 to explicitly accept unaudited PHI reads',
      );
    }
    options.onDegrade?.('missing_auditor');
    return;
  }

  try {
    await auditor(options.entry);
  } catch (error) {
    if (failClosed) {
      throw error instanceof PhiAuditUnavailableError
        ? error
        : new PhiAuditUnavailableError(
            error instanceof Error
              ? `PHI read auditor failed: ${error.message}`
              : 'PHI read auditor failed',
          );
    }
    options.onDegrade?.('auditor_threw', error);
  }
}
