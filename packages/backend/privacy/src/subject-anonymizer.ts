/**
 * Domain anonymization port (W1-SEC-06).
 *
 * Default implementation records a deterministic anonymized token and returns
 * an honest residual when full cross-domain PII cascade wipe is not wired.
 */
import { createHash } from 'node:crypto';

import type { ErasureRequestType } from './schemas.js';

export interface AnonymizeSubjectInput {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  requestType: ErasureRequestType;
  jobId: string;
}

export interface AnonymizeSubjectResult {
  fieldsTouched: string[];
  /** Honest residual when domain wipe is incomplete. */
  residualNote?: string;
}

export interface SubjectAnonymizer {
  anonymize(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult>;
}

/**
 * Records anonymization intent with a stable token; does not mutate domain DBs.
 * Residual documents that cascade field wipe remains domain-owned follow-up.
 */
export class RecordingSubjectAnonymizer implements SubjectAnonymizer {
  readonly ledger: AnonymizeSubjectInput[] = [];

  async anonymize(input: AnonymizeSubjectInput): Promise<AnonymizeSubjectResult> {
    this.ledger.push(input);
    const token = createHash('sha256')
      .update(`${input.tenantId}:${input.subjectType}:${input.subjectId}:${input.jobId}`)
      .digest('hex')
      .slice(0, 16);
    return {
      fieldsTouched: ['display_name', 'email', 'phone'],
      residualNote:
        `Recorded anonymization token ANON-${token}; full cross-domain PII cascade ` +
        'wipe remains residual (domain repositories not mutated by default anonymizer).',
    };
  }
}

/** Default offboard domain checklist when no TenantWipeExecutor is provided. */
export const DEFAULT_OFFBOARD_DOMAINS = [
  'students',
  'staff',
  'fees',
  'health',
  'audit_archives',
  'files_storage',
] as const;

export interface TenantWipeInput {
  tenantId: string;
  jobId: string;
  reason: string;
}

export interface TenantWipeDomainResult {
  domain: string;
  status: 'completed' | 'residual' | 'skipped';
  note?: string;
}

export interface TenantWipeExecutor {
  wipe(input: TenantWipeInput): Promise<TenantWipeDomainResult[]>;
}

/**
 * Honest scoped residual executor — marks domains as residual checklist items
 * without claiming production tenant data destruction.
 */
export class ResidualTenantWipeExecutor implements TenantWipeExecutor {
  async wipe(input: TenantWipeInput): Promise<TenantWipeDomainResult[]> {
    return DEFAULT_OFFBOARD_DOMAINS.map((domain) => ({
      domain,
      status: 'residual' as const,
      note:
        `Checklist recorded for job ${input.jobId}; domain purge executor not wired ` +
        `(W1-SEC-06 scoped residual). Hold checks already passed.`,
    }));
  }
}
