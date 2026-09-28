/**
 * Cross-board transfer state machine.
 * Illegal transitions are conflicts (HTTP 409). Role mismatches are forbidden (403).
 * Missing equivalency on a cross-board approval is a business rule failure (422).
 */
import { ConflictError, ForbiddenError } from '@proctira/common';

export const TRANSFER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type TransferWorkflowStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_DECISIONS = [
  'SUBMIT',
  'START_REVIEW',
  'APPROVE',
  'REJECT',
  'CANCEL',
  'COMPLETE',
] as const;

export type TransferDecision = (typeof TRANSFER_DECISIONS)[number];

const TRANSITIONS: Record<
  TransferWorkflowStatus,
  Partial<Record<TransferDecision, TransferWorkflowStatus>>
> = {
  DRAFT: { SUBMIT: 'SUBMITTED', CANCEL: 'CANCELLED' },
  SUBMITTED: { START_REVIEW: 'UNDER_REVIEW', CANCEL: 'CANCELLED' },
  UNDER_REVIEW: { APPROVE: 'APPROVED', REJECT: 'REJECTED', CANCEL: 'CANCELLED' },
  APPROVED: { COMPLETE: 'COMPLETED', CANCEL: 'CANCELLED' },
  REJECTED: {},
  COMPLETED: {},
  CANCELLED: {},
};

const ADMIN_ROLES = new Set(['admin', 'super-admin', 'platform_admin']);
const SOURCE_ROLES = new Set(['registrar', 'principal', ...ADMIN_ROLES]);
const DEST_ROLES = new Set(['principal', ...ADMIN_ROLES]);
const READ_ROLES = new Set(['teacher', 'staff', 'registrar', 'principal', ...ADMIN_ROLES]);

export interface TransferActor {
  userId: string;
  displayName: string;
  roleIds: string[];
  institutionIds: string[];
  ipAddress: string;
}

/** Status a decision lands on. A second call in that status is a replay, not a new event. */
const REPLAY_STATUS: Partial<Record<TransferDecision, TransferWorkflowStatus>> = {
  SUBMIT: 'SUBMITTED',
  START_REVIEW: 'UNDER_REVIEW',
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  CANCEL: 'CANCELLED',
  COMPLETE: 'COMPLETED',
};

export function isIdempotentReplay(
  status: TransferWorkflowStatus,
  decision: TransferDecision,
): boolean {
  return REPLAY_STATUS[decision] === status;
}

export function nextStatus(
  from: TransferWorkflowStatus,
  decision: TransferDecision,
): TransferWorkflowStatus {
  const to = TRANSITIONS[from][decision];
  if (!to) {
    throw new ConflictError(`Cannot ${decision} a transfer that is ${from}`);
  }
  return to;
}

export function isTerminal(status: TransferWorkflowStatus): boolean {
  return status === 'REJECTED' || status === 'COMPLETED' || status === 'CANCELLED';
}

function hasRole(actor: TransferActor, allowed: Set<string>): boolean {
  return actor.roleIds.some((role) => allowed.has(role));
}

function isAdmin(actor: TransferActor): boolean {
  return hasRole(actor, ADMIN_ROLES);
}

/** Empty institution list means the role is tenant-wide (seeded tenant admin). */
export function schoolInScope(actor: TransferActor, institutionId: string): boolean {
  if (isAdmin(actor) || actor.institutionIds.length === 0) return true;
  return actor.institutionIds.includes(institutionId);
}

export function assertCanRead(actor: TransferActor): void {
  if (!hasRole(actor, READ_ROLES)) {
    throw new ForbiddenError('You cannot view transfer approvals');
  }
}

export function assertCanDecide(
  actor: TransferActor,
  decision: TransferDecision,
  sourceInstitutionId: string,
  destinationInstitutionId: string,
): void {
  if (decision === 'SUBMIT') {
    if (!hasRole(actor, SOURCE_ROLES) || !schoolInScope(actor, sourceInstitutionId)) {
      throw new ForbiddenError(
        'Only the requesting registrar or principal can submit this transfer',
      );
    }
    return;
  }
  if (decision === 'CANCEL') {
    const sourceOk = hasRole(actor, SOURCE_ROLES) && schoolInScope(actor, sourceInstitutionId);
    const destOk = hasRole(actor, DEST_ROLES) && schoolInScope(actor, destinationInstitutionId);
    if (!sourceOk && !destOk) {
      throw new ForbiddenError('You cannot cancel this transfer');
    }
    return;
  }
  if (!hasRole(actor, DEST_ROLES) || !schoolInScope(actor, destinationInstitutionId)) {
    throw new ForbiddenError('Only the receiving principal can take this decision');
  }
}

export function assertCanEditEquivalency(actor: TransferActor): void {
  if (!isAdmin(actor)) {
    throw new ForbiddenError('Only a tenant administrator can edit grade equivalency');
  }
}

export function primaryRole(actor: TransferActor): string {
  return actor.roleIds[0] ?? 'unknown';
}
