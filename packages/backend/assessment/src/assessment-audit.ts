/**
 * PRC-M495: domain audit for assessment — score writes (before/after), grading-scheme and
 * assessment-item changes, report-card generation and report-card downloads (read audit:
 * `operation: 'CREATE'` with `metadata.read: true`, as gradebook does).
 *
 * The sink is injected by the gateway (shared hash-chained audit log) and awaited after the
 * mutation, so a failed write surfaces as an error. No sink means no behaviour change.
 */
import type { FastifyRequest } from 'fastify';

export interface AssessmentAuditEntry {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export type AssessmentAuditSink = (entry: AssessmentAuditEntry) => Promise<void>;

/** The authenticated caller recorded on audit entries. */
export interface AssessmentAuditContext {
  actorId: string | null;
}

export const NO_AUDIT_ACTOR: AssessmentAuditContext = { actorId: null };

/** Actor from the verified JWT subject on the request (null when absent). */
export function assessmentAuditContextOf(request: FastifyRequest): AssessmentAuditContext {
  const user = (request as FastifyRequest & { user?: { sub?: unknown } }).user;
  return { actorId: typeof user?.sub === 'string' && user.sub ? user.sub : null };
}
