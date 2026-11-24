/**
 * Policy audit port (PRC-M608).
 *
 * The policy package previously wrote **no** audit entry for policy lifecycle
 * mutations (create / update / activate / deactivate / assign / remove
 * assignment). Those are security-relevant state changes on multi-tenant
 * governance objects, so the owner must be able to attribute each to the real
 * actor and tenant.
 *
 * This port lets the composition root inject a durable, tenant-aware audit sink
 * that always carries the **real actor and tenant** taken from the verified
 * request. It is a package-local interface (dependency inversion): no new
 * package dependency is added, and when no port is injected the service simply
 * does not emit (existing behaviour and tests are unchanged), so the parked
 * package never writes a `'system'`-attributed or tenant-less audit row.
 */

/** The policy lifecycle actions that are audited. */
export type PolicyAuditAction =
  'create' | 'update' | 'activate' | 'deactivate' | 'assign' | 'remove_assignment';

/** The audit event the service hands to the port: the real actor and tenant are mandatory. */
export interface PolicyAuditEvent {
  action: PolicyAuditAction;
  /** The real verified actor id (never the literal `'system'`). */
  actor: string;
  /** The tenant the mutation was performed in (from the verified request context). */
  tenantId: string;
  /** The policy the mutation targeted. */
  policyId: string;
  /** Optional assignment id for assign / remove_assignment events. */
  assignmentId?: string | null;
}

/**
 * Sink for policy audit events. Implementations persist the event durably
 * (e.g. the platform's chained audit store) with the verified actor and tenant.
 */
export interface PolicyAuditPort {
  record(event: PolicyAuditEvent): Promise<void>;
}

/** Raised when a mutating policy route cannot determine the real actor. */
export class PolicyActorRequiredError extends Error {
  readonly statusCode = 401;
  readonly code = 'ACTOR_REQUIRED';

  constructor(message = 'A verified actor is required for this operation') {
    super(message);
    this.name = 'PolicyActorRequiredError';
  }
}
